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
  function setEnabled(on) {
    enabled = !!on;
    if (enabled) { if (ensure() && ctx.state === 'suspended') ctx.resume(); tick(0.8); }
    else if (ctx && ctx.state === 'running') ctx.suspend();
  }
  return { knock, coin, tick, whoosh, setEnabled, get enabled() { return enabled; } };
}
