/* ============================================
   Primal Clash — sound effects
   All sounds are generated with the Web Audio
   API (no files needed). To use real assets
   later, drop files into /audio and replace
   the corresponding functions below with
   `new Audio('audio/xyz.mp3').play()` (or Howler).
   ============================================ */
"use strict";

const SFX = (() => {
  let ctx = null;
  let muted = false;

  function ac() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  /* A single pitched blip: freq -> end over dur seconds. */
  function tone({ freq = 440, end = 0, dur = 0.15, type = 'sine', vol = 0.18, delay = 0 }) {
    if (muted) return;
    try {
      const a = ac();
      const t = a.currentTime + delay;
      const o = a.createOscillator();
      const g = a.createGain();
      o.type = type;
      o.frequency.setValueAtTime(freq, t);
      const target = end || freq;
      if (target !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(30, target), t + dur);
      g.gain.setValueAtTime(vol, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      o.connect(g).connect(a.destination);
      o.start(t);
      o.stop(t + dur + 0.05);
    } catch (e) { /* audio unavailable — ignore */ }
  }

  /* Short burst of filtered noise (for impacts). */
  function noise({ dur = 0.1, vol = 0.22, delay = 0, cutoff = 900 }) {
    if (muted) return;
    try {
      const a = ac();
      const t = a.currentTime + delay;
      const len = Math.max(1, Math.floor(a.sampleRate * dur));
      const buf = a.createBuffer(1, len, a.sampleRate);
      const data = buf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const src = a.createBufferSource();
      src.buffer = buf;
      const f = a.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = cutoff;
      const g = a.createGain();
      g.gain.value = vol;
      src.connect(f).connect(g).connect(a.destination);
      src.start(t);
    } catch (e) { /* ignore */ }
  }

  return {
    toggleMute() { muted = !muted; return muted; },
    isMuted() { return muted; },

    playCard() {
      tone({ freq: 330, end: 660, dur: 0.12, type: 'triangle' });
      tone({ freq: 660, end: 880, dur: 0.1, delay: 0.08, type: 'triangle', vol: 0.1 });
    },
    attack() {
      noise({ dur: 0.09, cutoff: 700 });
      tone({ freq: 220, end: 80, dur: 0.14, type: 'sawtooth', vol: 0.15 });
    },
    damage() {
      tone({ freq: 160, end: 70, dur: 0.12, type: 'square', vol: 0.13 });
    },
    death() {
      tone({ freq: 420, end: 55, dur: 0.4, type: 'sawtooth', vol: 0.14 });
      noise({ dur: 0.25, cutoff: 400, vol: 0.12, delay: 0.05 });
    },
    heal() {
      tone({ freq: 520, end: 780, dur: 0.2, type: 'sine', vol: 0.14 });
    },
    freeze() {
      tone({ freq: 980, end: 320, dur: 0.35, type: 'sine', vol: 0.12 });
      tone({ freq: 1240, end: 500, dur: 0.3, type: 'sine', vol: 0.08, delay: 0.08 });
    },
    win() {
      [523, 659, 784, 1047].forEach((f, i) =>
        tone({ freq: f, dur: 0.2, delay: i * 0.15, type: 'triangle', vol: 0.2 }));
    },
    lose() {
      [392, 330, 262, 196].forEach((f, i) =>
        tone({ freq: f, dur: 0.28, delay: i * 0.19, type: 'sawtooth', vol: 0.13 }));
    },
  };
})();
