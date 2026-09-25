// HOLM — a small procedural sound layer.
// Nothing is downloaded: every sound is synthesised from noise and sine tones the moment it is needed, in the
// spirit of a page with no files beyond itself. Silent until the visitor asks for sound, and suspended again
// the moment they turn it off.

export function createSound() {
  let ctx = null, master = null, enabled = false;

  function ensure() {
    if (ctx) return true;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return false;
    ctx = new AC();
    master = ctx.createGain(); master.gain.value = 0.9; master.connect(ctx.destination);
    // A touch of room: a short tail of decaying noise through a convolver, mixed in quietly.
    const len = Math.floor(ctx.sampleRate * 0.35), buf = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let c = 0; c < 2; c++) { const d = buf.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3.2) * 0.5; }
    const room = ctx.createConvolver(); room.buffer = buf;
    const wet = ctx.createGain(); wet.gain.value = 0.22;
    master.connect(room); room.connect(wet); wet.connect(ctx.destination);
    return true;
  }
  const noise = (dur) => {
    const n = Math.floor(ctx.sampleRate * dur), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
    const s = ctx.createBufferSource(); s.buffer = b; return s;
  };
  const env = (g, t0, peak, attack, decay) => {
    g.gain.cancelScheduledValues(t0);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, peak), t0 + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + attack + decay);
  };

  // A wooden knock: a filtered noise burst over a low body tone. Harder hits are brighter and louder.
  function knock(v = 1) {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime, k = Math.min(1, Math.max(0.15, v));
    const src = noise(0.12), bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = 900 + 1400 * k + Math.random() * 300; bp.Q.value = 1.2;
    const g = ctx.createGain(); env(g, t, 0.35 * k, 0.003, 0.07 + 0.05 * k);
    src.connect(bp); bp.connect(g); g.connect(master); src.start(t); src.stop(t + 0.15);
    const o = ctx.createOscillator(); o.type = 'sine';
    o.frequency.setValueAtTime(190 + Math.random() * 40, t); o.frequency.exponentialRampToValueAtTime(110, t + 0.09);
    const g2 = ctx.createGain(); env(g2, t, 0.22 * k, 0.002, 0.11);
    o.connect(g2); g2.connect(master); o.start(t); o.stop(t + 0.14);
  }
  // A coin landing in walnut: the knock with a small metallic ring on top.
  function coin(v = 1) {
    if (!enabled || !ensure()) return;
    knock(v * 0.8);
    const t = ctx.currentTime, k = Math.min(1, Math.max(0.2, v));
    for (const f of [3150, 4720, 6200]) {
      const o = ctx.createOscillator(); o.type = 'sine'; o.frequency.value = f * (0.97 + Math.random() * 0.06);
      const g = ctx.createGain(); env(g, t, 0.05 * k, 0.002, 0.16 + Math.random() * 0.1);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.35);
    }
  }
  // A short tick for controls and chapter changes.
  function tick(v = 1) {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime;
    const src = noise(0.03), hp = ctx.createBiquadFilter(); hp.type = 'highpass'; hp.frequency.value = 2400;
    const g = ctx.createGain(); env(g, t, 0.12 * v, 0.001, 0.025);
    src.connect(hp); hp.connect(g); g.connect(master); src.start(t); src.stop(t + 0.04);
  }
  // The flip: a noise sweep through a moving bandpass, then the tray meeting the desk face down.
  function whoosh() {
    if (!enabled || !ensure()) return;
    const t = ctx.currentTime;
    const src = noise(0.7), bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.Q.value = 0.8;
    bp.frequency.setValueAtTime(300, t); bp.frequency.exponentialRampToValueAtTime(1600, t + 0.35); bp.frequency.exponentialRampToValueAtTime(400, t + 0.7);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.28); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.7);
    src.connect(bp); bp.connect(g); g.connect(master); src.start(t); src.stop(t + 0.75);
    setTimeout(() => knock(0.7), 620);
  }
  // The lathe: a motor hum that rises with the spin and a filtered-noise cut that follows the carving rate.
  // Both are continuous, so their gains ramp instead of restarting.
  let lathe = null;
  function latheSound(level = 0, cutting = 0) {
    if (!enabled || !ctx) return;
    const t = ctx.currentTime;
    if (!lathe) {
      const osc = ctx.createOscillator(); osc.type = 'sawtooth'; osc.frequency.value = 42;
      const osc2 = ctx.createOscillator(); osc2.type = 'triangle'; osc2.frequency.value = 84.5;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 380; lp.Q.value = 0.7;
      const g = ctx.createGain(); g.gain.value = 0;
      osc.connect(lp); osc2.connect(lp); lp.connect(g); g.connect(master); osc.start(); osc2.start();
      const n = Math.floor(ctx.sampleRate * 1.5), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
      const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
      const bp = ctx.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = 1100; bp.Q.value = 0.9;
      const gc = ctx.createGain(); gc.gain.value = 0;
      src.connect(bp); bp.connect(gc); gc.connect(master); src.start();
      lathe = { osc, osc2, g, gc, bp };
    }
    const lv = Math.min(1, Math.max(0, level)), cv = Math.min(1, Math.max(0, cutting)) * lv;
    lathe.g.gain.setTargetAtTime(0.055 * lv, t, 0.12);
    lathe.osc.frequency.setTargetAtTime(30 + 26 * lv, t, 0.25); lathe.osc2.frequency.setTargetAtTime(60 + 52 * lv, t, 0.25);
    lathe.gc.gain.setTargetAtTime(0.11 * cv, t, 0.06);
    lathe.bp.frequency.setTargetAtTime(900 + 900 * cv, t, 0.08);
  }
  // Room tone: a whisper of low noise with a slow swell, so silence has a floor.
  let room = null;
  function startRoom() {
    if (room || !ctx) return;
    const n = Math.floor(ctx.sampleRate * 3), b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
    let last = 0; for (let i = 0; i < n; i++) { last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02; d[i] = last * 3.5; }
    const src = ctx.createBufferSource(); src.buffer = b; src.loop = true;
    const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 220;
    const g = ctx.createGain(); g.gain.value = 0.0001;
    const lfo = ctx.createOscillator(); lfo.frequency.value = 0.07; const lg = ctx.createGain(); lg.gain.value = 0.006; lfo.connect(lg); lg.connect(g.gain);
    src.connect(lp); lp.connect(g); g.connect(master); src.start(); lfo.start();
    g.gain.setTargetAtTime(0.016, ctx.currentTime, 1.2);
    room = { src, g };
  }
  function setEnabled(on) {
    enabled = !!on;
    if (enabled) { if (ensure() && ctx.state === 'suspended') ctx.resume(); startRoom(); tick(0.8); }
    else if (ctx && ctx.state === 'running') ctx.suspend();
  }
  return { knock, coin, tick, whoosh, lathe: latheSound, setEnabled, get enabled() { return enabled; } };
}
