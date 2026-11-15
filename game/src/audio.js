// audio.js — every sound in the game is synthesised here with WebAudio: no audio
// files, nothing fetched. Gunfire is a filtered noise burst with a body thump,
// reloads are timed clicks, the charge beeps faster as it runs down. Sounds are
// positional in a simple way: callers pass a distance and the helper turns it
// into gain and low-pass, so a rifle across the yard sounds far away.

let ctx = null;
let master = null;
let noiseBuffer = null;

export function initAudio() {
  if (ctx) {
    if (ctx.state === 'suspended') ctx.resume();
    return;
  }
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
  const len = ctx.sampleRate * 1;
  noiseBuffer = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = noiseBuffer.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
}

function env(gain, t0, peak, decay) {
  gain.gain.setValueAtTime(0.0001, t0);
  gain.gain.exponentialRampToValueAtTime(Math.max(peak, 0.0002), t0 + 0.004);
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + decay);
}

function noiseBurst({ at = 0, dur = 0.12, freq = 1800, q = 0.8, peak = 0.5, type = 'lowpass' }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer;
  src.playbackRate.value = 0.9 + Math.random() * 0.2;
  const filter = ctx.createBiquadFilter();
  filter.type = type;
  filter.frequency.value = freq;
  filter.Q.value = q;
  const gain = ctx.createGain();
  env(gain, t0, peak, dur);
  src.connect(filter).connect(gain).connect(master);
  src.start(t0, Math.random() * 0.4);
  src.stop(t0 + dur + 0.05);
}

function tone({ at = 0, dur = 0.1, freq = 440, slide = 0, peak = 0.2, type = 'square' }) {
  if (!ctx) return;
  const t0 = ctx.currentTime + at;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(freq, t0);
  if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(30, freq + slide), t0 + dur);
  const gain = ctx.createGain();
  env(gain, t0, peak, dur);
  osc.connect(gain).connect(master);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
}

// Distance shaping: 1 at the muzzle, quiet and muffled across the map.
function shape(dist) {
  const d = Math.max(0, dist || 0);
  return { gain: 1 / (1 + d * 0.12), muffle: Math.max(300, 4000 - d * 90) };
}

export const sfx = {
  shot(kind, dist = 0) {
    const s = shape(dist);
    if (kind === 'sniper') {
      noiseBurst({ dur: 0.5, freq: s.muffle, peak: 0.9 * s.gain });
      tone({ dur: 0.22, freq: 120, slide: -70, peak: 0.5 * s.gain, type: 'triangle' });
    } else if (kind === 'shotgun') {
      noiseBurst({ dur: 0.3, freq: s.muffle * 0.7, peak: 0.8 * s.gain });
      tone({ dur: 0.16, freq: 100, slide: -50, peak: 0.45 * s.gain, type: 'triangle' });
    } else if (kind === 'smg') {
      noiseBurst({ dur: 0.09, freq: s.muffle * 1.2, peak: 0.5 * s.gain });
      tone({ dur: 0.07, freq: 160, slide: -60, peak: 0.3 * s.gain, type: 'triangle' });
    } else if (kind === 'pistol') {
      noiseBurst({ dur: 0.11, freq: s.muffle * 1.1, peak: 0.55 * s.gain });
      tone({ dur: 0.08, freq: 150, slide: -60, peak: 0.3 * s.gain, type: 'triangle' });
    } else {
      noiseBurst({ dur: 0.16, freq: s.muffle, peak: 0.7 * s.gain });
      tone({ dur: 0.1, freq: 130, slide: -60, peak: 0.4 * s.gain, type: 'triangle' });
    }
  },
  dry() { tone({ dur: 0.04, freq: 1200, peak: 0.12 }); },
  reload() {
    tone({ dur: 0.03, freq: 700, peak: 0.15 });
    tone({ at: 0.14, dur: 0.03, freq: 500, peak: 0.15 });
    tone({ at: 0.3, dur: 0.04, freq: 900, peak: 0.2 });
  },
  pump() { noiseBurst({ at: 0.12, dur: 0.07, freq: 900, peak: 0.25 }); },
  bolt() { tone({ at: 0.1, dur: 0.03, freq: 600, peak: 0.18 }); tone({ at: 0.22, dur: 0.03, freq: 800, peak: 0.18 }); },
  hit(head) {
    tone({ dur: 0.05, freq: head ? 2100 : 1500, peak: 0.22, type: 'sine' });
    if (head) tone({ at: 0.02, dur: 0.07, freq: 2600, peak: 0.18, type: 'sine' });
  },
  kill() { tone({ dur: 0.09, freq: 880, peak: 0.2, type: 'sine' }); tone({ at: 0.07, dur: 0.12, freq: 1320, peak: 0.2, type: 'sine' }); },
  hurt() { noiseBurst({ dur: 0.1, freq: 500, peak: 0.3 }); },
  step(dist = 0) {
    const s = shape(dist);
    noiseBurst({ dur: 0.05, freq: 400, peak: 0.1 * s.gain });
  },
  throwIt() { noiseBurst({ dur: 0.18, freq: 1200, peak: 0.12, type: 'bandpass' }); },
  fragBoom(dist = 0) {
    const s = shape(dist);
    noiseBurst({ dur: 0.7, freq: 300, peak: 1.0 * s.gain });
    tone({ dur: 0.5, freq: 70, slide: -30, peak: 0.7 * s.gain, type: 'sine' });
  },
  flashPop(dist = 0) {
    const s = shape(dist);
    noiseBurst({ dur: 0.25, freq: 5000, peak: 0.5 * s.gain, type: 'highpass' });
    tone({ dur: 1.4, freq: 6200, peak: 0.06 * s.gain, type: 'sine' }); // the ring in your ears
  },
  smokeHiss(dist = 0) {
    const s = shape(dist);
    noiseBurst({ dur: 0.9, freq: 3000, peak: 0.15 * s.gain, type: 'bandpass' });
  },
  beep(fast = false) { tone({ dur: 0.05, freq: fast ? 1560 : 1180, peak: 0.16, type: 'sine' }); },
  plantDone() { tone({ dur: 0.08, freq: 980, peak: 0.2, type: 'sine' }); tone({ at: 0.09, dur: 0.12, freq: 1470, peak: 0.2, type: 'sine' }); },
  explosion() {
    noiseBurst({ dur: 1.6, freq: 220, peak: 1.0 });
    tone({ dur: 1.2, freq: 55, slide: -20, peak: 0.9, type: 'sine' });
    noiseBurst({ at: 0.15, dur: 1.0, freq: 900, peak: 0.4 });
  },
  sting(win) {
    const base = win ? [392, 523, 659] : [330, 262, 196];
    base.forEach((f, i) => tone({ at: i * 0.13, dur: 0.22, freq: f, peak: 0.2, type: 'triangle' }));
  },
  buy() { tone({ dur: 0.05, freq: 1040, peak: 0.15, type: 'sine' }); tone({ at: 0.05, dur: 0.07, freq: 1560, peak: 0.15, type: 'sine' }); },
  denied() { tone({ dur: 0.09, freq: 220, peak: 0.15 }); },
  scope() { tone({ dur: 0.03, freq: 900, peak: 0.08 }); },
};
